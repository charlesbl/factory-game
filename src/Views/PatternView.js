import React from 'react';

class PatternView extends React.Component {
    render() {
        return (
            <div>
                {this.props.pattern.name}
                {this.props.pattern.totalCost.itemStacks["ironPlate"].quantity}
            </div>
        );
    }
}
export default PatternView;
