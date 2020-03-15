import React from 'react';

class MachineView extends React.Component{
    render() {
        return (
            <div>
                {this.props.machine.craft.name}: {this.props.machine.getPercentage()}%
            </div>
        );
    }
}
export default MachineView;