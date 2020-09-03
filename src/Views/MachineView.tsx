import React from 'react';
import '../css/Machine.css'
import Machine from '../Game/Machine';
import ItemsCraftView from './ItemsCraftView';

interface IMachineProps {
    machine: Machine
}

class MachineView extends React.Component<IMachineProps> {
    render() {
        var canCraft = this.props.machine.canCraft() || this.props.machine.isCrafting;
        var craftBtn = <button onMouseDown={() => this.props.machine.start()}
            onMouseUp={() => this.props.machine.stop()}
            onMouseOut={() => this.props.machine.stop()}
            className="btn btn-success btn-side btn-craft" disabled={!canCraft}>
            <i className="fas fa-hammer fa-xs"></i>
        </button>;

        var pauseBtn = <button onClick={() => this.props.machine.togglePause()} className="btn btn-warning btn-side">{this.props.machine.isPaused ? <i className="fas fa-play fa-xs"></i> : <i className="fas fa-pause fa-xs"></i>}</button>;
        var destroyBtn = <button onClick={() => this.props.machine.destroy()} className="btn btn-danger btn-side"><i className="fas fa-trash fa-xs"></i></button>;
        var actions = this.props.machine.manual ? <div className="btn-wrapper">{craftBtn}</div> : <div className="btn-wrapper">{pauseBtn}{destroyBtn}</div>
        return (
            <div className="machine">
                <div className="name">{this.props.machine.name}</div>
                <progress className="progress" max={100} value={this.props.machine.getPercentage()}></progress>
                <div className="wrapper">
                    <ItemsCraftView itemStacks={this.props.machine.craft.input} craftDuration={this.props.machine.craft.duration} />
                    <div>
                        <div>{this.props.machine.getPercentage().toFixed(0)}%</div>
                        <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                        <div>{(this.props.machine.craft.duration / 1000).toFixed(1)}s</div>
                        {actions}
                    </div>
                    <ItemsCraftView itemStacks={this.props.machine.craft.output} craftDuration={this.props.machine.craft.duration} />
                </div>
            </div>
        );
    }
}
export default MachineView;