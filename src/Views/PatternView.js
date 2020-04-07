import React from 'react';

class PatternView extends React.Component {
    render() {
        return (
            <div>
                <div>{this.props.pattern.name}</div>
                <div>{this.props.pattern.totalCost.itemStacks["ironPlate"].quantity}</div>
                <div>{this.props.pattern.id}</div>
            </div>
        );
    }
}
export default PatternView;
